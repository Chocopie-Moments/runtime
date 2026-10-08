import React, { useImperativeHandle, useRef } from 'react';
import { Image, Platform } from 'react-native';
import type { ViewProps } from 'react-native';
import NativeView, { Commands } from './ChocoNativeViewNativeComponent';

export type ChocoPalette = { accent: number; secondary: number; ink: number; background: number };
export type ChocoHandle = {
  /** Call after onReady. Commands before the asset loads report onError. */
  trigger: (name: 'enter' | 'hover' | 'click') => void;
  seek: (seconds: number) => void;
  /** Coordinates are in the asset's viewBox; null releases pointer gaze. */
  look: (point: { x: number; y: number } | null) => void;
  /** Opaque integer 0xRRGGBB colors. */
  setPalette: (palette: ChocoPalette) => void;
};

export type ChocoProps = ViewProps & {
  /** A Metro require('./moment.choco'), bundle:// resource, file URI or HTTPS asset URL. */
  source: number | string;
  state?: string;
  paused?: boolean;
  /** Disable playback in offscreen cells that remain mounted. */
  playbackEnabled?: boolean;
  ref?: React.Ref<ChocoHandle>;
  onReady?: () => void;
  onError: (error: Error) => void;
};

export function Choco({ source, state, paused = false, playbackEnabled = true, ref, onReady, onError, ...view }: ChocoProps) {
  const native = useRef<React.ElementRef<typeof NativeView>>(null);
  useImperativeHandle(ref, () => {
    function mounted() {
      if (!native.current) throw new Error('The Choco view is not mounted');
      return native.current;
    }
    return {
      trigger: name => Commands.trigger(mounted(), name),
      seek: seconds => Commands.seek(mounted(), seconds),
      look: point => Commands.look(mounted(), point !== null, point?.x ?? 0, point?.y ?? 0),
      setPalette: palette => Commands.palette(mounted(), palette.accent, palette.secondary, palette.ink, palette.background),
    };
  }, []);
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') throw new Error('This Choco development package supports iOS and Android only.');
  const uri = typeof source === 'number' ? Image.resolveAssetSource(source)?.uri : source;
  if (!uri) throw new Error('Could not resolve the .choco asset. Add choco to Metro assetExts.');
  return <NativeView {...view} ref={native} source={uri} state={state} paused={paused} playbackEnabled={playbackEnabled}
    onLoad={() => onReady?.()} onError={event => onError(new Error(event.nativeEvent.message))} />;
}
