import { Config } from '@remotion/cli/config';

/**
 * Delivery settings for the PARALITH launch film.
 *
 * The film is almost entirely flat colour, hairlines and small type on a near-black
 * field, which is exactly the content JPEG intermediates handle worst. Frames are
 * therefore captured as PNG so the 1px rules and 12px monospace stamps survive the
 * trip into the encoder, and H.264 is written with a low CRF in BT.709.
 */
Config.setVideoImageFormat('png');
Config.setPixelFormat('yuv420p');
Config.setCodec('h264');
Config.setCrf(16);
Config.setColorSpace('bt709');
Config.setChromiumOpenGlRenderer('angle');
Config.setOverwriteOutput(true);
Config.setIPv4(true);
Config.setStudioPort(4100);
Config.setRendererPort(4101);
