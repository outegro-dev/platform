import { Module } from "@nestjs/common";
import {
  CvDeviceController,
  CvLinksController,
} from "../cv-links/cv-links.controller.js";
import { CvLinksService } from "../cv-links/cv-links.service.js";
import { AtelierController } from "./atelier.controller.js";
import { BoardService } from "./board.service.js";
import { OwnerService } from "./owner.service.js";

/** atelier-web's API and the public CV links (api role). */
@Module({
  controllers: [AtelierController, CvDeviceController, CvLinksController],
  providers: [BoardService, OwnerService, CvLinksService],
})
export class ApiModule {}
