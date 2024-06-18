"use server";

import connectToDB from "@/lib/model/database";
import getSession from "../server-hooks/getsession.action";
import Wallet from "@/lib/schemas/wallet";
import User from "@/lib/schemas/user";
import Transaction, { TransactionType } from "@/lib/schemas/transaction"; // Adjust import as per your schema file
import {
    Connection,
    Keypair,
    PublicKey,
    clusterApiUrl,
    VersionedTransaction,
    TransactionMessage,
    // Transaction,
    LAMPORTS_PER_SOL,
    SendTransactionError,
    // ConfirmOptions,
  } from '@solana/web3.js';
  import {
    getAssociatedTokenAddress,
    getOrCreateAssociatedTokenAccount,
    createAssociatedTokenAccount,
    getAccount,
    TOKEN_PROGRAM_ID,
    createTransferInstruction,
    createAssociatedTokenAccountInstruction,
    TokenAccountNotFoundError,
    TokenInvalidAccountOwnerError,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  } from '@solana/spl-token';


interface SendFundsToMilestonUserParams {
    receiverEmail: string;
    amount: string;
}

export async function sendFundsToMilestonUser(params: SendFundsToMilestonUserParams) {
    try {
        // Ensure the database connection is established
        await connectToDB();

        // Get the current user session (sender)
        const senderSession = await getSession();
        if (!senderSession || !senderSession.userId) {
            return { error: "Sender is not authenticated" };
        }

        // Fetch sender's wallet
        const senderWallet = await Wallet.findOne({ user: senderSession.userId });
        if (!senderWallet) {
            return { error: "Sender's wallet not found" };
        }

        // Validate sender has enough balance
        const amountToSend = parseFloat(params.amount);
        if (senderWallet.balance < amountToSend) {
            return { error: "Insufficient balance to send funds" };
        }

        // Get receiver user details
        const receiverUser = await User.findOne({ email: params.receiverEmail });
        if (!receiverUser) {
            return { error: "Receiver user not found" };
        }

        // Fetch receiver's wallet
        const receiverWallet = await Wallet.findOne({ user: receiverUser._id });
        if (!receiverWallet) {
            return { error: "Receiver's wallet not found" };
        }

        // Update sender's wallet balance (subtract amount)
        senderWallet.balance -= amountToSend;
        await senderWallet.save();

        // Update receiver's wallet balance (add amount)
        receiverWallet.balance += amountToSend;
        await receiverWallet.save();

        // Log transaction details
        console.log(`Funds transferred from ${senderSession.email} to ${params.receiverEmail}: ${amountToSend}`);

        // Create transaction document
        const newTransaction = new Transaction({
            type: TransactionType.SENT,
            sender: senderSession.userId,
            receiver: receiverUser._id,
            amount: amountToSend,
            currency: 'USDC', // Assuming default currency
            timestamp: new Date()
        });

        // Save transaction to database
        await newTransaction.save();

        // Return success message
        return { message: "Transaction completed successfully!" };
    } catch (error) {
        console.error("Error transferring funds:", error);
        return { error: "Unable to transfer. Please try again later." };
    }
}


interface SendFundsToExternalWalletParams {
    walletAddress: string;
    usdcNetwork: string;
    amount: string;
}

export async function sendFundsToExternalWallet(params: SendFundsToExternalWalletParams) {
    try {

        const connection = new Connection(clusterApiUrl('devnet'), 'confirmed');
        const usdcMintAddress = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'); // USDC Mint Address (Dev Net)

        // const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
        const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
        
        let ownerStuff;

        if (!process.env.publicKey || !process.env.secretKey) {
            return {error: "Invalid Keys"};
        } else {
            ownerStuff = {
                publicKey: process.env.publicKey,
                secretKey: process.env.secretKey,
            };
        };

        const owner = Keypair.fromSecretKey(Buffer.from(ownerStuff.secretKey, 'hex'));
    
        // Ensure the database connection is established
        await connectToDB();

        // Get the current user session (sender)
        const senderSession = await getSession();
        if (!senderSession || !senderSession.userId) {
            return { error: "Sender is not authenticated" };
        }

        // Fetch sender's wallet
        const senderWallet = await Wallet.findOne({ user: senderSession.userId });
        if (!senderWallet) {
            return { error: "Sender's wallet not found" };
        }

        // Validate sender has enough balance
        const amountToSend = parseFloat(params.amount);
        if (senderWallet.balance < amountToSend) {
            return { error: "Insufficient balance to send funds" };
        }

        // Fetch receiver's wallet
        const receiverWallet = params.walletAddress;

        const receiverPublicKey = new PublicKey(receiverWallet)

        // Send the amount Onchain 
        const sourceTokenAccount = await getAssociatedTokenAddress(
            usdcMintAddress,
            owner.publicKey,
        );
        const destinationTokenAccount = await getAssociatedTokenAddress(
            usdcMintAddress,
            receiverPublicKey,
        );
      
        const instructions = [
            createTransferInstruction(
              sourceTokenAccount,
              destinationTokenAccount,
              owner.publicKey,
              amountToSend * 10 ** 6, // Assuming USDC has 6 decimals
              [],
              TOKEN_PROGRAM_ID,
            ),
        ];
      
        const { blockhash } = await connection.getLatestBlockhash();
        const message = new TransactionMessage({
            payerKey: owner.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();
      
        const transaction = new VersionedTransaction(message);
        transaction.sign([owner]);
      
        const signature = await connection.sendTransaction(transaction);
        await connection.confirmTransaction(signature, 'confirmed');

        // Update sender's wallet balance (subtract amount)
        senderWallet.balance -= amountToSend;
        await senderWallet.save();

        // Log transaction details
        console.log(`Funds transferred from ${senderSession.email} to ${params.walletAddress}: ${amountToSend}`);

        // Create transaction document
        const newTransaction = new Transaction({
            type: TransactionType.SENT,
            sender: senderSession.userId,
            receiver: params.walletAddress,
            amount: amountToSend,
            currency: 'USDC', // Assuming default currency
            timestamp: new Date()
        });

        // Save transaction to database
        await newTransaction.save();

        // Return success message
        return { message: "Transaction completed successfully!" };
    } catch (error) {
        console.error("Error transferring funds:", error);
        return { error: "Unable to transfer. Please try again later." };
    }
}
