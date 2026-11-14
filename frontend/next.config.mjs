/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  // Tailwind CSS v4 is already installed via @tailwindcss/turbopack.
  // Route global CSS through its loader so utility classes are generated.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
      },
    },
  },
};

export default nextConfig;
