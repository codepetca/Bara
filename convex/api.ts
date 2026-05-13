import { anyApi, type ApiFromModules } from "convex/server";
import type * as appUsers from "./appUsers";
import type * as attendance from "./attendance";
import type * as integrations from "./integrations";
import type * as participants from "./participants";
import type * as rosters from "./rosters";
import type * as schedules from "./schedules";
import type * as sessions from "./sessions";

type AppApi = ApiFromModules<{
  appUsers: typeof appUsers;
  attendance: typeof attendance;
  integrations: typeof integrations;
  participants: typeof participants;
  rosters: typeof rosters;
  schedules: typeof schedules;
  sessions: typeof sessions;
}>;

export const api = anyApi as unknown as AppApi;
