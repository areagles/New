import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The host serves plain files: .htaccess maps any path to <path>/index.html, exactly as the
  // system it replaces is deployed. No Node runtime is available on this shared hosting.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
