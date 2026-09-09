/**
 * CSS Modules, as far as the type checker is concerned.
 *
 * A component imports its own stylesheet and reads class names off it. Vite
 * turns that into an object at build time; without this declaration the type
 * checker only sees an import of a file it has no idea how to read.
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

/** Plain stylesheets are imported for their effect, not for a value. */
declare module '*.css';
