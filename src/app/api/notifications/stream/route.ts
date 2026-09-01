import { NextRequest } from 'next/server';
import { requireSession } from '@/lib/authz';
import { eventBus, NexoraEvent } from '@/lib/events';
import { fail } from '@/lib/apiResponse';

export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

export async function GET(req: NextRequest) {
  let session;
  try {
    session = await requireSession(req);
  } catch (error) {
    return fail(error);
  }
  const organizationId = session.member?.organizationId;
  if (!organizationId) {
    return fail(new Error('Super admin accounts do not have a live notification stream.'));
  }

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: NexoraEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`));
      };

      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));
      unsubscribe = eventBus.subscribe(organizationId, send);

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, HEARTBEAT_MS);
    },
    cancel() {
      clearInterval(heartbeat);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
