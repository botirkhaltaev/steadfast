import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyMediaItem, parseWebhookBody } from "#lib/wassist";

const base = {
  event: "message.received",
  conversationId: "conv-1",
  from: "+447700900200",
  contact: { phoneNumber: "+447700900200", name: "Alex" },
};

test("classifyMediaItem uses mimeType before URL heuristics", () => {
  assert.equal(
    classifyMediaItem({
      url: "https://media.wassist.app/x.ogg",
      mimeType: "audio/ogg; codecs=opus",
    }),
    "audio",
  );
  assert.equal(
    classifyMediaItem({
      url: "https://media.wassist.app/x.bin",
      mimeType: "image/jpeg",
    }),
    "image",
  );
  assert.equal(
    classifyMediaItem({ url: "https://media.wassist.app/meal.jpg" }),
    "image",
  );
  assert.equal(
    classifyMediaItem({ url: "https://media.wassist.app/note.ogg" }),
    "unknown",
  );
});

test("audio-only message is accepted", () => {
  const parsed = parseWebhookBody({
    ...base,
    message: {
      id: "msg-audio",
      body: "",
      media: [
        {
          url: "https://media.wassist.app/v.ogg",
          mimeType: "audio/ogg; codecs=opus",
        },
      ],
    },
  });
  assert.equal(parsed.kind, "message");
  if (parsed.kind !== "message") return;
  assert.equal(parsed.message.imageUrl, null);
  assert.equal(parsed.message.audioUrl, "https://media.wassist.app/v.ogg");
  assert.equal(parsed.message.audioMimeType, "audio/ogg; codecs=opus");
  assert.equal(parsed.message.text, "");
});

test("image-only message is unchanged", () => {
  const parsed = parseWebhookBody({
    ...base,
    message: {
      id: "msg-image",
      body: "Lunch",
      media: [
        {
          url: "https://media.wassist.app/meal.jpg",
          mimeType: "image/jpeg",
        },
      ],
    },
  });
  assert.equal(parsed.kind, "message");
  if (parsed.kind !== "message") return;
  assert.equal(parsed.message.imageUrl, "https://media.wassist.app/meal.jpg");
  assert.equal(parsed.message.audioUrl, null);
  assert.equal(parsed.message.audioMimeType, null);
  assert.equal(parsed.message.text, "Lunch");
});

test("mixed media sets both image and audio", () => {
  const parsed = parseWebhookBody({
    ...base,
    message: {
      id: "msg-mixed",
      body: null,
      media: [
        {
          url: "https://media.wassist.app/meal.png",
          mimeType: "image/png",
        },
        {
          url: "https://media.wassist.app/note.ogg",
          mimeType: "audio/ogg",
        },
      ],
    },
  });
  assert.equal(parsed.kind, "message");
  if (parsed.kind !== "message") return;
  assert.equal(parsed.message.imageUrl, "https://media.wassist.app/meal.png");
  assert.equal(parsed.message.audioUrl, "https://media.wassist.app/note.ogg");
  assert.equal(parsed.message.audioMimeType, "audio/ogg");
});

test("empty body with no classifiable media is ignored", () => {
  const parsed = parseWebhookBody({
    ...base,
    message: {
      id: "msg-empty",
      body: "  ",
      media: [{ url: "https://media.wassist.app/note.ogg" }],
    },
  });
  assert.equal(parsed.kind, "ignored");
});

test("audio is never treated as a meal image", () => {
  const parsed = parseWebhookBody({
    ...base,
    message: {
      id: "msg-audio-only",
      body: null,
      media: [
        {
          url: "https://media.wassist.app/v.ogg",
          mimeType: "audio/mpeg",
        },
      ],
    },
  });
  assert.equal(parsed.kind, "message");
  if (parsed.kind !== "message") return;
  assert.equal(parsed.message.imageUrl, null);
  assert.ok(parsed.message.audioUrl);
});
