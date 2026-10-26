// src/mocks/handlers.ts
import { projectHandlers } from "./handlers/projects";
import { scriptHandlers } from "./handlers/scripts";
import { audioHandlers } from "./handlers/audio";
import { authHandlers } from "./handlers/auth";

export const handlers = [
  ...authHandlers,
  ...projectHandlers,
  ...scriptHandlers,
  ...audioHandlers,
];
