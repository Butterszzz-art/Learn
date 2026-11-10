import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Neuron — swipe through real science",
    short_name: "Neuron",
    description: "A swipe feed where every card teaches you something real — and helps you remember it.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#120f1e",
    theme_color: "#120f1e",
    categories: ["education", "science"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Review", url: "/review", description: "Ideas due for review" },
      { name: "Explore", url: "/explore", description: "Search and learning paths" },
    ],
  };
}
