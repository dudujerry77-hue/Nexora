import { ok } from '@/lib/apiResponse';
import { clearSessionCookies } from '@/lib/sessionCookies';

export async function POST() {
  const response = ok({ loggedOut: true });
  clearSessionCookies(response);
  return response;
}
