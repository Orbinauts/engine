// Vitest serves a text fixture as a string through Vite's `?raw` import.
declare module "*.txt?raw" {
  const text: string;
  export default text;
}
