import { randomBytes, randomUUID } from "node:crypto";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "@paper-duel/protocol";

/** 128-bit random session token, hex encoded. */
export function newSessionToken(): string {
  return randomBytes(16).toString("hex");
}

export function newId(): string {
  return randomUUID();
}

export function newRoomCode(randomInt: (n: number) => number): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
