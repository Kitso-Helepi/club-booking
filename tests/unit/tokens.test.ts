import { beforeAll, describe, expect, it } from "vitest";
import { decryptToken, encryptToken, hashToken, looksLikeToken, newBookingReference, newToken } from "@/server/tokens";
import { extractToken } from "@/server/checkin";
import { roleCan } from "@/server/permissions";
import { formatMoney } from "@/lib/format";

beforeAll(() => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
});

describe("tokens", () => {
  it("round-trips encryption and never stores the plain token in the hash", () => {
    const t = newToken();
    expect(looksLikeToken(t)).toBe(true);
    const enc = encryptToken(t);
    expect(enc).not.toContain(t);
    expect(decryptToken(enc)).toBe(t);
    expect(hashToken(t)).toHaveLength(64);
  });

  // Tamper with decoded BYTES, not base64 characters: the last base64url
  // character carries padding bits, so editing characters can leave the bytes
  // unchanged (that made an earlier version of this test flaky, ~1 in 150 runs).
  const flipFirstByte = (b64url: string) => {
    const bytes = Buffer.from(b64url, "base64url");
    bytes[0] ^= 0x01;
    return bytes.toString("base64url");
  };

  it("detects tampered ciphertext", () => {
    for (let i = 0; i < 50; i++) {
      const [v, iv, tag, ct] = encryptToken(newToken()).split(".");
      expect(() => decryptToken([v, iv, tag, flipFirstByte(ct)].join("."))).toThrow();
    }
  });

  it("detects a tampered authentication tag", () => {
    const [v, iv, tag, ct] = encryptToken(newToken()).split(".");
    expect(() => decryptToken([v, iv, flipFirstByte(tag), ct].join("."))).toThrow();
  });

  it("booking references avoid ambiguous characters", () => {
    for (let i = 0; i < 50; i++) expect(newBookingReference()).toMatch(/^CB-[2-9A-HJ-NP-Z]{8}$/);
  });

  it("extracts tokens from pass URLs and bare values", () => {
    const t = newToken();
    expect(extractToken(`https://x.test/p/${t}`)).toBe(t);
    expect(extractToken(` ${t} `)).toBe(t);
  });
});

describe("roles", () => {
  it("door staff can only check in and look up", () => {
    expect(roleCan("door", "door.check_in")).toBe(true);
    expect(roleCan("door", "orders.view")).toBe(false);
    expect(roleCan("manager", "club.manage")).toBe(false);
    expect(roleCan("owner", "club.manage")).toBe(true);
  });
});

describe("money", () => {
  it("formats minor units", () => {
    expect(formatMoney(450000, "ZAR")).toMatch(/4[\s  ]?500[,.]00/);
  });
});
