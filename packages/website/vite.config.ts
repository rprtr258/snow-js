import {defineConfig} from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [],
  base: "",
  server: {
    watch: {
      ignored: ["**/.jj/**"],
    },
  },
});
