import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Dependency-free local sandbox. Shell/file tools are disabled for this health agent.
export default defineSandbox({
  backend: justbash(),
});
