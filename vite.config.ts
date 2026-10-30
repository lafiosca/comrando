import { defineConfig } from 'vite';

// Relative asset paths: the same build works at the site's root and at /v/<version>/, where every release stays
// online (an old seed link opens the version that made it: main.ts).
export default defineConfig({ base: './' });
