import { Connector } from './types';
import { customApiConnector, customWebhookConnector, jsSdkConnector } from './nexoraNative';
import { woocommerceConnector } from './woocommerce';
import { shopifyConnector } from './shopify';

export * from './types';

export const connectorRegistry: Record<string, Connector> = {
  custom_api: customApiConnector,
  custom_webhook: customWebhookConnector,
  js_sdk: jsSdkConnector,
  woocommerce: woocommerceConnector,
  shopify: shopifyConnector,
};

export function getConnector(provider: string): Connector | undefined {
  return connectorRegistry[provider];
}

export function listConnectors(): Connector[] {
  return Object.values(connectorRegistry);
}
