import { getSetting, setSetting } from './store.js';
import { SERVICE_PROFILES, serviceForHost, serviceProfile, type ServiceProfile } from './services.js';

export interface GatewayRouting {
  profile: string;
  country: string | null;
}

const PROFILE_KEY = 'gateway.routing.profile';
const COUNTRY_KEY = 'gateway.routing.country';

const validProfile = (value: string | null) =>
  value === 'auto' || value === 'general' || Boolean(value && serviceProfile(value));

export function getGatewayRouting(): GatewayRouting {
  const storedProfile = getSetting(PROFILE_KEY);
  const storedCountry = getSetting(COUNTRY_KEY);
  return {
    profile: validProfile(storedProfile) ? storedProfile! : 'auto',
    country: storedCountry && /^[A-Z]{2}$/.test(storedCountry) ? storedCountry : null,
  };
}

export function updateGatewayRouting(input: unknown): GatewayRouting {
  if (!input || typeof input !== 'object') return getGatewayRouting();
  const patch = input as Record<string, unknown>;
  if (typeof patch.profile === 'string' && validProfile(patch.profile)) {
    setSetting(PROFILE_KEY, patch.profile);
  }
  if (patch.country === null || patch.country === '') {
    setSetting(COUNTRY_KEY, '');
  } else if (typeof patch.country === 'string' && /^[A-Z]{2}$/.test(patch.country)) {
    setSetting(COUNTRY_KEY, patch.country);
  }
  return getGatewayRouting();
}

export interface ResolvedGatewayRoute {
  profile: ServiceProfile | null;
  country: string | null;
}

export function resolveGatewayRoute(host: string): ResolvedGatewayRoute {
  const routing = getGatewayRouting();
  const profile = routing.profile === 'auto'
    ? serviceForHost(host)
    : routing.profile === 'general'
      ? null
      : serviceProfile(routing.profile);
  return { profile, country: routing.country };
}

export const gatewayProfiles = () => [
  { id: 'auto', name: '智能识别', targetId: null },
  { id: 'general', name: '通用代理', targetId: null },
  ...SERVICE_PROFILES.map((profile) => ({
    id: profile.id,
    name: profile.name,
    targetId: profile.target.id,
  })),
];
