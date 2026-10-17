// src/mocks/handlers.ts
import { projectHandlers } from "./handlers/projects";
import { scriptHandlers } from "./handlers/scripts";
import { audioHandlers } from "./handlers/audio";

export const handlers = [
  ...projectHandlers,
  ...scriptHandlers,
  ...audioHandlers,
];