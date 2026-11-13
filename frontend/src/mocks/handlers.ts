import { http, HttpResponse, delay } from 'msw';
import { dispatch } from './server';
export const handlers = [http.all('/api/*', async ({ request }) => {
  await delay(180);
  try { return await dispatch(request); }
  catch (error) { return HttpResponse.json({ code: 'MOCK_ERROR', message: error instanceof Error ? error.message : '模拟接口异常', data: null, request_id: crypto.randomUUID(), timestamp: new Date().toISOString() }, { status: 500 }); }
})];
