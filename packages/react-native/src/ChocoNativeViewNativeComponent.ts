import { codegenNativeComponent, codegenNativeCommands } from 'react-native';
import type { HostComponent, ViewProps, CodegenTypes } from 'react-native';
import type React from 'react';

export interface NativeProps extends ViewProps {
  source: string;
  state?: string;
  paused?: CodegenTypes.WithDefault<boolean, false>;
  playbackEnabled?: CodegenTypes.WithDefault<boolean, true>;
  onLoad?: CodegenTypes.DirectEventHandler<Readonly<{ loaded: boolean }>>;
  onError?: CodegenTypes.DirectEventHandler<Readonly<{ message: string }>>;
}
interface NativeCommands {
  trigger: (view: React.ElementRef<HostComponent<NativeProps>>, name: string) => void;
  seek: (view: React.ElementRef<HostComponent<NativeProps>>, seconds: CodegenTypes.Double) => void;
  look: (view: React.ElementRef<HostComponent<NativeProps>>, active: boolean, x: CodegenTypes.Double, y: CodegenTypes.Double) => void;
  palette: (view: React.ElementRef<HostComponent<NativeProps>>, accent: CodegenTypes.Double, secondary: CodegenTypes.Double, ink: CodegenTypes.Double, background: CodegenTypes.Double) => void;
}
export const Commands = codegenNativeCommands<NativeCommands>({ supportedCommands: ['trigger', 'seek', 'look', 'palette'] });
export default codegenNativeComponent<NativeProps>('ChocoNativeView') as HostComponent<NativeProps>;
