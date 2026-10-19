// Episode routes.
//   POST /episodes  {id, title, ...}       -> stores metadata, returns a presigned PUT URL
//   POST /episodes  {id, ready: true}      -> after the upload: marks ready and notifies
//   GET  /episodes                         -> ready episodes, newest first
//   GET  /episodes/<id>                    -> one ready episode with a presigned audio URL
// Notifying only after the audio is confirmed in the bucket means a tap on
// the notification never opens an episode that cannot play yet.
import { EPISODE_ID, Episode, audioUploaded, audioUrl, getEpisode, listEpisodes, mergeEpisode, putEpisode } from "../episodes";
import { Deps } from "../deps";
import { json, readJson } from "../http";
import { publish } from "../push/fanout";
import { Route } from "../router";

const UPLOAD_SECONDS = 3600;
const PLAY_SECONDS = 3600;

const view = (deps: Deps, e: Episode) => ({ ...e, audioUrl: audioUrl(deps, e, "GET", PLAY_SECONDS) });

export const episodeRoutes: Route[] = [
  {
    method: "POST",
    pattern: /^\/episodes$/,
    run: async ({ deps, event }) => {
      if (!deps.env.mediaBucket) return json(503, { error: "no media bucket configured" });
      const body = readJson(event);
      const existing = typeof body.id === "string" ? await getEpisode(deps, body.id) : null;
      const episode = mergeEpisode(body, existing, deps.now());

      if (body.ready !== true) {
        await putEpisode(deps, episode);
        return json(200, {
          ok: true,
          episode,
          upload: {
            url: audioUrl(deps, episode, "PUT", UPLOAD_SECONDS),
            method: "PUT",
            headers: { "content-type": episode.contentType },
            expiresIn: UPLOAD_SECONDS,
          },
        });
      }

      if (!(await audioUploaded(deps, episode))) {
        return json(409, { error: "audio not uploaded yet; PUT it to the upload URL, then post ready:true again" });
      }
      const ready: Episode = { ...episode, status: "ready" };
      await putEpisode(deps, ready);
      const push = await publish(deps, {
        event: "episode",
        refId: ready.id,
        title: "New episode ready",
        body: ready.title,
        data: { type: "episode", id: ready.id, path: `/episodes/${ready.id}` },
      });
      return json(200, { ok: true, episode: ready, push });
    },
  },
  {
    method: "GET",
    pattern: /^\/episodes$/,
    run: async ({ deps }) => {
      const episodes = (await listEpisodes(deps)).filter((e) => e.status === "ready");
      return json(200, { episodes: episodes.map((e) => view(deps, e)) });
    },
  },
  {
    method: "GET",
    pattern: new RegExp(`^/episodes/${EPISODE_ID}$`),
    run: async ({ deps, params }) => {
      const e = await getEpisode(deps, params[0]);
      if (!e || e.status !== "ready") return json(404, { error: "not found" });
      return json(200, view(deps, e));
    },
  },
];
