import { useVideoConfig } from 'remotion';

export type FilmFormat = 'landscape' | 'square' | 'vertical';

export type FilmLayout = {
  width: number;
  height: number;
  format: FilmFormat;
  safeX: number;
  safeY: number;
  product: { x: number; y: number; width: number; height: number };
  headlineSize: number;
  bodySize: number;
};

export const useFilmLayout = (): FilmLayout => {
  const { width, height } = useVideoConfig();
  const ratio = width / height;
  const format: FilmFormat = ratio < 0.8 ? 'vertical' : ratio < 1.25 ? 'square' : 'landscape';
  const safeX = format === 'vertical' ? width * 0.065 : width * 0.07;
  const safeY = format === 'vertical' ? height * 0.045 : height * 0.07;

  const product =
    format === 'vertical'
      ? {
          x: safeX,
          y: height * 0.27,
          width: width - safeX * 2,
          height: height * 0.47,
        }
      : format === 'square'
        ? {
            x: safeX,
            y: height * 0.21,
            width: width - safeX * 2,
            height: height * 0.56,
          }
        : {
            x: safeX,
            y: safeY * 0.82,
            width: width - safeX * 2,
            height: height * 0.72,
          };

  return {
    width,
    height,
    format,
    safeX,
    safeY,
    product,
    headlineSize:
      format === 'vertical' ? width * 0.085 : format === 'square' ? width * 0.067 : width * 0.046,
    bodySize:
      format === 'vertical' ? width * 0.036 : format === 'square' ? width * 0.026 : width * 0.017,
  };
};
