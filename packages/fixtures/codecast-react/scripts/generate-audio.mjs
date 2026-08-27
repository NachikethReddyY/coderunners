import { mkdir, writeFile } from "node:fs/promises";

const durationSeconds = 70;
const sampleRate = 8_000;
const channels = 1;
const bitsPerSample = 16;
const bytesPerSample = bitsPerSample / 8;
const dataBytes = durationSeconds * sampleRate * channels * bytesPerSample;
const wav = Buffer.alloc(44 + dataBytes);

wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write("WAVE", 8, "ascii");
wav.write("fmt ", 12, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(channels, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
wav.writeUInt16LE(channels * bytesPerSample, 32);
wav.writeUInt16LE(bitsPerSample, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(dataBytes, 40);

const audioDirectory = new URL("../audio/", import.meta.url);
await mkdir(audioDirectory, { recursive: true });
await writeFile(new URL("codecast.wav", audioDirectory), wav);
