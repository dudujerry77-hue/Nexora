import { EventEmitter } from 'events';

// In-process pub/sub for real-time dashboard updates via SSE. See
// docs/ARCHITECTURE.md "Real-time updates" for the production scaling note
// (swap for Redis pub/sub behind this same interface).

export interface NexoraEvent {
  type:
    | 'notification.created'
    | 'order.created'
    | 'order.updated'
    | 'integration.status_changed'
    | 'monitoring.issue_created'
    | 'monitoring.issue_updated';
  organizationId: string;
  payload: unknown;
}

class NexoraEventBus extends EventEmitter {
  publish(event: NexoraEvent) {
    this.emit(event.organizationId, event);
  }

  subscribe(organizationId: string, handler: (event: NexoraEvent) => void) {
    this.on(organizationId, handler);
    return () => this.off(organizationId, handler);
  }
}

const globalForBus = globalThis as unknown as { nexoraEventBus?: NexoraEventBus };

export const eventBus = globalForBus.nexoraEventBus ?? new NexoraEventBus();
if (process.env.NODE_ENV !== 'production') {
  eventBus.setMaxListeners(0);
  globalForBus.nexoraEventBus = eventBus;
}
