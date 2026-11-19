import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(here, '../../'),
  transpilePackages: ['@cardiy/ui'],
  poweredByHeader: false,
};

export default nextConfig;
