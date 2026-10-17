export async function enableMocking() {
  const enabled = import.meta.env.VITE_ENABLE_MOCK === "true";
  if (!enabled) return;

  if (import.meta.env.MODE !== "development") {
    throw new Error("Mock 只允许在开发环境启用");
  }

  const { worker } = await import("./browser");

  await worker.start();
}
