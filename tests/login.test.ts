import { describe, expect, it } from "vitest";
import { normalizeServer } from "../src/client/api";

describe("登录页的服务器地址", () => {
  it("不带协议时补 https://，去掉末尾的 /，前后空格不算", () => {
    expect(normalizeServer(" anki-everything.example.workers.dev/ ")).toBe("https://anki-everything.example.workers.dev");
    expect(normalizeServer("https://a.example.dev//")).toBe("https://a.example.dev");
    expect(normalizeServer("http://localhost:8787")).toBe("http://localhost:8787");
  });
});
