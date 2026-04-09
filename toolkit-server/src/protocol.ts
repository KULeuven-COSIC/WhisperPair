import { ec as EC } from "elliptic";
import crypto from "crypto";
import { BN } from "bn.js";

/** Removes : from a Bluetooth address. */
function convertAddressToHex(address: string) {
  return address.replaceAll(":", "").toLowerCase();
}

/** Generates a session key for Fast Pair communication. */
function generateSharedSecret(publicKey: Buffer) {
  // generate an ephemeral elliptic curve key pair
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();

  const generatedPublicKey = ecdh.getPublicKey();
  const generatedPrivateKey = ecdh.getPrivateKey();

  const e = new EC("p256");
  const k1 = e.keyFromPrivate(generatedPrivateKey.toString("hex"), "hex");
  const k2 = e.keyFromPublic("04" + publicKey.toString("hex"), "hex");

  const sharedSecret = Buffer.from(k1.derive(k2.getPublic()).toString("hex"), "hex");

  return {
    secret: crypto.createHash("sha256").update(sharedSecret).digest().subarray(0, 16),
    generatedPublicKey,
  };
}

/** Generate an invalid shared secret. */
function generateInvalidSharedSecret() {
  // point with order 5
  const fakePublicKey = Buffer.concat([
    Buffer.from([0x04]),
    Buffer.from("b70bf043c144935756f8f4578c369cf960ee510a5a0f90e93a373a21f0d1397f", "hex"),
    Buffer.from("4a2e0ded57a5156bb82eb4314c37fd4155395a7e51988af289cce531b9c17192", "hex"),
  ]);

  // there are a couple of possible messages
  const set = new Set<string>();
  const e = new EC("p256");

  const seekerKey = e.keyFromPublic(fakePublicKey.toString("hex"), "hex");
  for (let i = 0; i < 5; i++) {
    try {
      const possibleSharedPoint = seekerKey.getPublic().mul(new BN(i, 10));
      set.add(possibleSharedPoint.getX().toString("hex"));
    } catch {}
  }

  const possibleSecrets = Array.from(set.values()).map((secret) =>
    crypto.createHash("sha256").update(secret).digest().subarray(0, 16),
  );

  return {
    secrets: possibleSecrets,
    generatedPublicKey: fakePublicKey,
  };
}

/** Generates a payload for the initial pairing request. */
function generatePayload(address: string, secret: Buffer, generatedPublicKey: Buffer) {
  const nonce = crypto.randomBytes(8);

  const rawRequest = Buffer.concat([
    Buffer.from([0x00, 0x00]),
    Buffer.from(convertAddressToHex(address), "hex"),
    nonce,
  ]);

  // cipher configuration
  const cipher = crypto.createCipheriv("aes-128-ecb", secret, null);
  const decipher = crypto.createDecipheriv("aes-128-ecb", secret, null);
  cipher.setAutoPadding(false);
  decipher.setAutoPadding(false);
  const encryptedRequest = cipher.update(rawRequest);

  // full payload
  const payload = Buffer.concat([encryptedRequest, generatedPublicKey.subarray(1)]);

  return { payload, cipher, decipher };
}

/** Generates an encrypted key based pairing message. */
export function generateKeyBasedPairingMessage(address: string, publicKey: Buffer) {
  const { secret, generatedPublicKey } = generateSharedSecret(publicKey);
  return generatePayload(address, secret, generatedPublicKey);
}

/** Generates pairing messages using an invalid curve. */
export function generatePossibleInvalidKeyBasedPairingMessages(address: string) {
  const { secrets, generatedPublicKey } = generateInvalidSharedSecret();
  return secrets.map((secret) => generatePayload(address, secret, generatedPublicKey));
}

/** Generates an encrypted passkey message. */
export async function generatePasskeyMessage(cipher: crypto.Cipheriv, passkey: number) {
  const passkeyBuffer = Buffer.alloc(3);
  passkeyBuffer.writeUIntBE(passkey, 0, 3);

  const plaintext = Buffer.concat([Buffer.from([0x02]), passkeyBuffer, crypto.randomBytes(12)]);
  return cipher.update(plaintext);
}

const protocol = {
  generateKeyBasedPairingMessage,
  generatePasskeyMessage,
  generatePossibleInvalidKeyBasedPairingMessages,
};

export default protocol;
