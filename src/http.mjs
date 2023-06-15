//@format
import { env } from "process";

import express from "express";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import cookieParser from "cookie-parser";

import log from "./logger.mjs";
import * as store from "./store.mjs";
import { SCHEMATA } from "./constants.mjs";
import * as registry from "./chainstate/registry.mjs";

import feed from "./views/feed.mjs";
import newest from "./views/new.mjs";
import privacy from "./views/privacy.mjs";
import nft from "./views/nft.mjs";
import subscribe from "./views/subscribe.mjs";
import guidelines from "./views/guidelines.mjs";
import submit from "./views/submit.mjs";
import upvotes from "./views/upvotes.mjs";
import community from "./views/community.mjs";
import dau from "./views/dau.mjs";
import activity from "./views/activity.mjs";
import about from "./views/about.mjs";
import why from "./views/why.mjs";
import themes from "./themes.mjs";

const ajv = new Ajv();
addFormats(ajv);
const app = express();
const api = express.Router();
app.use(express.static("src/public"));
app.use(express.json());
app.use(cookieParser());

function loadTheme(req, res, next) {
  const themeId = parseInt(req.cookies.currentTheme, 10);
  const savedTheme = themes.find((theme) => theme.id === themeId);

  const theme = savedTheme || {
    id: 14,
    emoji: "🥝",
    name: "Kiwi News",
    color: "limegreen",
  };

  res.locals.theme = theme;

  next();
}
app.use(loadTheme);

if (!env.THEME_COLOR || !env.THEME_EMOJI || !env.THEME_NAME) {
  throw new Error(
    "The environment variables THEME_COLOR, THEME_EMOJI and THEME_NAME must be defined"
  );
}

export function sendError(reply, code, message, details) {
  log(`http error: "${code}", "${message}", "${details}"`);
  return reply.status(code).json({
    status: "error",
    code,
    message,
    details,
  });
}

export function sendStatus(reply, code, message, details, data) {
  const obj = {
    status: "success",
    code,
    message,
    details,
  };
  if (data) obj.data = data;
  return reply.status(code).json(obj);
}

export function handleMessage(trie, libp2p, getAllowlist) {
  return async (request, reply) => {
    const message = request.body;
    const allowlist = await getAllowlist();
    try {
      await store.add(trie, message, libp2p, allowlist);
    } catch (err) {
      const code = 400;
      const httpMessage = "Bad Request";
      return sendError(reply, code, httpMessage, err.toString());
    }

    const code = 200;
    const httpMessage = "OK";
    const details = "Message included";
    return sendStatus(reply, code, httpMessage, details);
  };
}

export function listAllowed(getAllowlist) {
  return async (request, reply) => {
    const code = 200;
    const httpMessage = "OK";
    const details = "Returning allow list";
    return sendStatus(reply, code, httpMessage, details, await getAllowlist());
  };
}

// TODO: We should return information about the total amount of leaves
// somewhere potentially.
export function listMessages(trie) {
  const requestValidator = ajv.compile(SCHEMATA.pagination);
  return async (request, reply) => {
    const result = requestValidator(request.body);
    if (!result) {
      const code = 400;
      const message = "Bad Request";
      const details = `Wrongly formatted message: ${JSON.stringify(
        requestValidator.errors
      )}`;
      return sendError(reply, code, message, details);
    }

    const { from, amount } = request.body;
    const parser = JSON.parse;
    const leaves = await store.leaves(trie, from, amount, parser);
    const code = 200;
    const message = "OK";
    const details = `Extracted leaves from "${from}" and amount "${amount}"`;
    return sendStatus(reply, code, message, details, leaves);
  };
}

export async function launch(trie, libp2p) {
  app.get("/", async (request, reply) => {
    let page = parseInt(request.query.page);
    if (isNaN(page) || page < 1) {
      page = 0;
    }
    const content = await feed(trie, reply.locals.theme, page);
    return reply.status(200).type("text/html").send(content);
  });
  // NOTE: During the process of combining the feed and the editor's picks, we
  // decided to expose people to the community pick's tab right from the front
  // page, which is why while deprecating the /feed, we're forwarding to root.
  app.get("/feed", function (req, res) {
    res.redirect(301, "/");
  });
  app.get("/new", async (request, reply) => {
    const content = await newest(trie, reply.locals.theme);
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/community", async (request, reply) => {
    const content = await community(trie, reply.locals.theme);
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/dau", async (request, reply) => {
    const content = await dau(trie, reply.locals.theme);
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/about", async (request, reply) => {
    const content = await about(trie, reply.locals.theme);
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/why", async (request, reply) => {
    const content = await why(trie, reply.locals.theme);
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/guidelines", async (request, reply) => {
    const content = await guidelines(trie, reply.locals.theme);
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/activity", async (request, reply) => {
    const { content, lastUpdate } = await activity(
      trie,
      reply.locals.theme,
      request.query.address
    );
    if (lastUpdate) {
      reply.setHeader("X-LAST-UPDATE", lastUpdate);
      reply.cookie("lastUpdate", lastUpdate);
    }
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/subscribe", async (request, reply) => {
    return reply
      .status(200)
      .type("text/html")
      .send(subscribe(reply.locals.theme));
  });
  app.get("/privacy-policy", async (request, reply) => {
    return reply
      .status(200)
      .type("text/html")
      .send(privacy(reply.locals.theme));
  });
  app.get("/welcome", async (request, reply) => {
    return reply.status(200).type("text/html").send(nft(reply.locals.theme));
  });
  app.get("/upvotes", async (request, reply) => {
    const content = await upvotes(
      trie,
      reply.locals.theme,
      request.query.address
    );
    return reply.status(200).type("text/html").send(content);
  });
  app.get("/submit", async (request, reply) => {
    return reply.status(200).type("text/html").send(submit(reply.locals.theme));
  });

  api.post("/list", listMessages(trie));
  api.get("/allowlist", listAllowed(registry.allowlist));
  api.post("/messages", handleMessage(trie, libp2p, registry.allowlist));

  app.use("/api/v1", api);
  app.listen(env.HTTP_PORT, () =>
    log(`Launched HTTP server at port "${env.HTTP_PORT}"`)
  );
}
