const { ethers } = require("ethers");

const RPC_URL =
  process.env.SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";

const CONTRACT_ADDRESS =
  "0x29D44DD684F7cCb0C61D3A7B3FC1ff2f98b99AAd";

const provider = new ethers.JsonRpcProvider(RPC_URL);

const ABI = [
  "function hasMinted(address) view returns (bool)",
  "function getRole(address) view returns (uint8)",
  "function balanceOf(address) view returns (uint256)"
];

const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  ABI,
  provider
);

async function verifySBT(walletAddress) {
  if (!ethers.isAddress(walletAddress)) {
    throw new Error("Invalid wallet address");
  }

  const wallet = ethers.getAddress(walletAddress);

  const hasMinted = await contract.hasMinted(wallet);
  const balance = await contract.balanceOf(wallet);

  if (!hasMinted || balance < 1n) {
    return {
      verified: false,
      role: "none",
      walletAddress: wallet
    };
  }

  const roleId = Number(await contract.getRole(wallet));

  let role = "none";

  if (roleId === 1) {
    role = "Top Forecaster";
  } else if (roleId === 2) {
    role = "Market Creator";
  }

  return {
    verified: role !== "none",
    role,
    roleId,
    walletAddress: wallet
  };
}

module.exports = {
  verifySBT,
  CONTRACT_ADDRESS
};
