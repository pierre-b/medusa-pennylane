import { Module } from "@medusajs/framework/utils";
import PennylaneModuleService from "./service";

export const PENNYLANE_MODULE = "pennylane";

export default Module(PENNYLANE_MODULE, {
  service: PennylaneModuleService,
});
