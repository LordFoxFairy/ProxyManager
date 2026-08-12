export interface ServiceProfile {
  id: string;
  name: string;
  target: {
    id: string;
    name: string;
    url: string;
  };
  domains: string[];
}

export const SERVICE_PROFILES: ServiceProfile[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    target: { id: 'openai', name: 'OpenAI API', url: 'https://api.openai.com/v1/models' },
    domains: ['openai.com', 'chatgpt.com'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    target: { id: 'anthropic', name: 'Anthropic API', url: 'https://api.anthropic.com/v1/models' },
    domains: ['anthropic.com', 'claude.ai'],
  },
  {
    id: 'github',
    name: 'GitHub',
    target: { id: 'github', name: 'GitHub', url: 'https://github.com/' },
    domains: ['github.com', 'githubusercontent.com', 'githubassets.com'],
  },
  {
    id: 'google',
    name: 'Google',
    target: { id: 'google', name: 'Google', url: 'https://www.google.com/generate_204' },
    domains: ['google.com', 'gstatic.com', 'googleapis.com'],
  },
  {
    id: 'npm',
    name: 'npm',
    target: { id: 'npm', name: 'npm Registry', url: 'https://registry.npmjs.org/-/ping' },
    domains: ['npmjs.org'],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    target: { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/generate_204' },
    domains: ['youtube.com', 'googlevideo.com', 'ytimg.com'],
  },
];

export const serviceProfile = (id: string) =>
  SERVICE_PROFILES.find((profile) => profile.id === id) ?? null;

export const serviceForHost = (host: string) => {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return SERVICE_PROFILES.find((profile) =>
    profile.domains.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`)),
  ) ?? null;
};
