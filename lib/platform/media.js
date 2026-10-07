import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function locate(config, capture, prompt) {
  const dir = join(config.stateDir, "screenshots");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${randomUUID()}.png`);
  const png = Buffer.from(capture.png, "base64");
  await writeFile(path, png, { mode: 0o600 });
  const token = (await readFile(config.mediaTokenFile, "utf8")).trim();
  const client = new Client({ name: "camofox-agent", version: "1.0.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(config.mediaUrl), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    const result = await client.callTool(
      {
        name: "locate_anything",
        arguments: {
          image_path: path,
          prompt,
          task: "ground_multi",
          generation_mode: "hybrid",
          max_new_tokens: 2048,
        },
      },
      undefined,
      { timeout: 610000 },
    );
    if (result.isError)
      throw Object.assign(
        new Error(
          "LocateAnything failed; inspect the private MediaTools job log before retrying",
        ),
        { statusCode: 502, code: "locate_failed" },
      );
    const data =
      result.structuredContent ||
      JSON.parse(result.content.find((c) => c.type === "text").text);
    const boxes = (data.boxes || []).filter(
      (b) =>
        [b.x1, b.y1, b.x2, b.y2].every(Number.isFinite) &&
        b.x1 >= 0 &&
        b.y1 >= 0 &&
        b.x2 <= capture.width &&
        b.y2 <= capture.height &&
        b.x2 > b.x1 &&
        b.y2 > b.y1,
    );
    const overlays = boxes
      .map(
        (b, i) =>
          `<rect x="${b.x1}" y="${b.y1}" width="${b.x2 - b.x1}" height="${b.y2 - b.y1}" fill="none" stroke="#ff273f" stroke-width="3"/><rect x="${b.x1}" y="${Math.max(0, b.y1 - 26)}" width="34" height="26" fill="#ff273f"/><text x="${b.x1 + 7}" y="${Math.max(20, b.y1 - 6)}" fill="white" font-family="sans-serif" font-size="20">${i + 1}</text>`,
      )
      .join("");
    const overlay = await sharp(png)
      .composite([
        {
          input: Buffer.from(
            `<svg width="${capture.width}" height="${capture.height}">${overlays}</svg>`,
          ),
        },
      ])
      .png()
      .toBuffer();
    return {
      boxes: boxes.map(({ x1, y1, x2, y2 }, i) => ({
        targetNumber: i + 1,
        x1,
        y1,
        x2,
        y2,
      })),
      screenshot: { data: overlay.toString("base64"), mimeType: "image/png" },
    };
  } finally {
    await client.close().catch(() => {});
    await unlink(path).catch(() => {});
  }
}
