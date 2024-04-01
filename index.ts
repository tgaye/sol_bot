import axios from 'axios';
import { createJupiterApiClient, DefaultApi, IndexedRouteMapResponse } from "../src/index";
import { Connection, Keypair, VersionedTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
require('dotenv').config();
const fs = require('fs');

// Read and prepare the private key
const keypairPath = 'C:/Users/User/Desktop/Metaplex/Owner2.json';
const keypairArray = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
const privateKeyBuffer = Buffer.from(keypairArray);
console.log("Private Key Buffer:", privateKeyBuffer);

type RouteMap = Record<string, string[]>;

function inflateIndexedRouteMap(result: IndexedRouteMapResponse): Record<string, string[]> {
  const { mintKeys, indexedRouteMap } = result;
  return Object.entries(indexedRouteMap).reduce<RouteMap>((acc, [inputMintIndexString, outputMintIndices]) => {
    const inputMintIndex = Number(inputMintIndexString);
    const inputMint = mintKeys[inputMintIndex];
    if (!inputMint) throw new Error(`Could no find mint key for index ${inputMintIndex}`);
    acc[inputMint] = outputMintIndices.map((index) => {
      const outputMint = mintKeys[index];
      if (!outputMint) throw new Error(`Could no find mint key for index ${index}`);
      return outputMint;
    });
    return acc;
  }, {});
}


async function getTokenPrice(tokenId: string): Promise<number | null> {
  try {
    console.log(`Fetching price for token ID: ${tokenId}`);
    const response = await axios.get(`https://price.jup.ag/v4/price?ids=${tokenId}`);
    if (response.data && response.data.data && response.data.data[tokenId]) {
      const price = response.data.data[tokenId].price;
      console.log(`Fetched price: ${price}`);
      return price;
    } else {
      console.log("Price data not available in the response");
      return null;
    }
  } catch (error) {
    console.error("Error fetching token price:", error);
    return null;
  }
}


function randomDelay(minSeconds: number, maxSeconds: number) {
  return new Promise(resolve => {
    const delayTime = Math.random() * (maxSeconds - minSeconds) + minSeconds;
    setTimeout(resolve, delayTime * 1000);
  });
}

let lastPrice: number | null = null;
let isTradeInProgress = false; 

async function checkAndExecuteTrade(jupiterQuoteApi: DefaultApi, wallet: Wallet, connection: Connection, outputMint: string, amountInLamports: number) {
  // if (isTradeInProgress) {
  //   console.log("A trade is currently in progress. Skipping this iteration.");
  //   return;
  // }

  try {
    console.log("Checking token price...");
    const currentPrice = await getTokenPrice(outputMint);

    if (currentPrice === null) {
      console.log("Unable to fetch current price. Skipping trade...");
      return;
    }

    if (lastPrice === null) {
      console.log(`Initial price check: ${currentPrice}. Waiting for the next price check to compare.`);
    } else if (currentPrice < lastPrice) {
      console.log(`Current price (${currentPrice}) is lower than the last price (${lastPrice}). Doing Nothing...`);
      
      // // Buy trade logic
      // const buyQuote = await jupiterQuoteApi.quoteGet({
      //   inputMint: "So11111111111111111111111111111111111111112",
      //   outputMint: outputMint,
      //   amount: amountInLamports,
      //   slippageBps: 100,
      //   onlyDirectRoutes: false,
      //   asLegacyTransaction: false,
      // });

      // if (!buyQuote) {
      //   console.error("Unable to get buy quote");
      //   return;
      // }

      // const buyResult = await jupiterQuoteApi.swapPost({
      //   swapRequest: {
      //     quoteResponse: buyQuote,
      //     userPublicKey: wallet.publicKey.toBase58(),
      //     dynamicComputeUnitLimit: true,
      //   },
      // });

      // if (!buyResult || !buyResult.swapTransaction) {
      //   console.error("Failed to get buy swap transaction");
      //   return;
      // }

      // const buyTransactionBuf = Buffer.from(buyResult.swapTransaction, "base64");
      // const buyTransaction = VersionedTransaction.deserialize(buyTransactionBuf);
      // buyTransaction.sign([wallet.payer]);
      // const buyRawTransaction = buyTransaction.serialize();
      // const buyTxid = await connection.sendRawTransaction(buyRawTransaction, {
      //   skipPreflight: true,
      //   preflightCommitment: 'finalized',
      //   maxRetries: 5,
      // });
      // await connection.confirmTransaction(buyTxid);
      // console.log(`Buy Transaction ID: https://solscan.io/tx/${buyTxid}`);
      isTradeInProgress = false;
    } 

    else if (currentPrice > lastPrice) {
      console.log(`Current price (${currentPrice}) is higher than the last price (${lastPrice}). Executing sell trade...`);
      isTradeInProgress = true;

      const tokenAmountToSell = (0.01 / currentPrice) * Math.pow(10, 2); // Calculate the amount of token to sell
      const tokenAmountInSmallestUnit = Math.round(tokenAmountToSell * Math.pow(10, 9)); // Adjust for token's decimal places
      
      const sellQuote = await jupiterQuoteApi.quoteGet({
        inputMint: outputMint,
        outputMint: "So11111111111111111111111111111111111111112",
        amount: tokenAmountInSmallestUnit, // Use the calculated token amount
        slippageBps: 100,
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      });
      

      if (!sellQuote) {
        console.error("Unable to get sell quote");
        return;
      }

      const sellResult = await jupiterQuoteApi.swapPost({
        swapRequest: {
          quoteResponse: sellQuote,
          userPublicKey: wallet.publicKey.toBase58(),
          dynamicComputeUnitLimit: true,
        },
      });

      if (!sellResult || !sellResult.swapTransaction) {
        console.error("Failed to get sell swap transaction");
        return;
      }

      const sellTransactionBuf = Buffer.from(sellResult.swapTransaction, "base64");
      const sellTransaction = VersionedTransaction.deserialize(sellTransactionBuf);
      sellTransaction.sign([wallet.payer]);
      const sellRawTransaction = sellTransaction.serialize();
      const sellTxid = await connection.sendRawTransaction(sellRawTransaction, {
        skipPreflight: true,
        preflightCommitment: 'finalized',
        maxRetries: 5,
      });
      await connection.confirmTransaction(sellTxid);
      console.log(`Sell Transaction ID: https://solscan.io/tx/${sellTxid}`);
      isTradeInProgress = false;

      await randomDelay(15, 60);
      console.log("Delay Over Buying Back now");

    } else {
      console.log(`Current price (${currentPrice}) is the same as the last price (${lastPrice}). No trade action required.`);
    }
      
    lastPrice = currentPrice;
  } catch (error) {
    console.error("An error occurred:", error);
  }
}


async function main() {
  const jupiterQuoteApi = createJupiterApiClient();
  const wallet = new Wallet(Keypair.fromSecretKey(privateKeyBuffer));
  const connection = new Connection("https://mainnet.helius-rpc.com/?api-key=f60fdf54-c254-4601-b227-95391d9e76ee");
  const amountInLamports = 0.05 * LAMPORTS_PER_SOL;
  const outputMint = "EXA537HSBVpsFijENbt6Muuy9AADUN8dUmYKD4oKbjJE";

  // Run the check and trade execution every 5 minutes
  setInterval(() => checkAndExecuteTrade(jupiterQuoteApi, wallet, connection, outputMint, amountInLamports), 20000);}

main();
