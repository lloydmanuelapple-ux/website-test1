import assert from "node:assert/strict";
import test from "node:test";
import { AuthorityType, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { createMintAuthorityInstructions } from "./authority-instructions.js";

for (const keepMintAuthority of [false, true]) {
  for (const keepFreezeAuthority of [false, true]) {
    test(`mint authority ${keepMintAuthority ? "retained" : "revoked"}, freeze authority ${keepFreezeAuthority ? "retained" : "revoked"}`, () => {
      const mint = Keypair.generate().publicKey;
      const owner = Keypair.generate().publicKey;
      const { initializeMint, revokeMintAuthority } = createMintAuthorityInstructions({
        mint,
        owner,
        decimals: 6,
        keepMintAuthority,
        keepFreezeAuthority,
      });

      assert.equal(initializeMint.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
      assert.equal(initializeMint.data[0], 0);
      assert.equal(initializeMint.data[1], 6);
      assert.equal(initializeMint.data[34], keepFreezeAuthority ? 1 : 0);
      if (keepFreezeAuthority) {
        assert.deepEqual(initializeMint.data.subarray(35, 67), owner.toBuffer());
      }

      if (keepMintAuthority) {
        assert.equal(revokeMintAuthority, null);
      } else {
        assert.ok(revokeMintAuthority);
        assert.equal(revokeMintAuthority.data[0], 6);
        assert.equal(revokeMintAuthority.data[1], AuthorityType.MintTokens);
        assert.equal(revokeMintAuthority.data[2], 0);
      }
    });
  }
}