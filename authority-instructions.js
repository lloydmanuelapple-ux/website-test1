import {
  AuthorityType,
  createInitializeMintInstruction,
  createSetAuthorityInstruction,
} from "@solana/spl-token";

export function createMintAuthorityInstructions({ mint, owner, decimals, keepMintAuthority, keepFreezeAuthority }) {
  return {
    initializeMint: createInitializeMintInstruction(
      mint,
      decimals,
      owner,
      keepFreezeAuthority ? owner : null,
    ),
    revokeMintAuthority: keepMintAuthority
      ? null
      : createSetAuthorityInstruction(mint, owner, AuthorityType.MintTokens, null),
  };
}