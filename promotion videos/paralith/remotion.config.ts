import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("png");
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setColorSpace("bt709");
Config.setCrf(14);
Config.setX264Preset("slow");
Config.setChromiumOpenGlRenderer("angle");
Config.setConcurrency(4);
