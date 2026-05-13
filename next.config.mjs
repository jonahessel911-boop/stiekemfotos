/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,

  /**
   * Tree-shake icon libraries: lucide-react in barrel-import mode trekt anders
   * honderden icons in client bundles mee. Spaart 50-200kB JS per pagina.
   */
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },

  /**
   * Sta Next/Image-optimalisatie toe voor Supabase Storage (publieke bucket)
   * en eventuele lokale `/api/conversations/.../image/...` legacy URLs.
   */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
