import React, {useRef, useState} from 'react';
import {Button, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Choco, type ChocoHandle} from '@chocopie/react-native';

// Only redistributable shared-runtime fixtures belong in this proof app.
const fixtures = {
  flow: require('./assets/flow.choco'),
  strokes: require('./assets/strokes.choco'),
  pulse: require('./assets/pulse.choco'),
};

export default function App() {
  const player = useRef<ChocoHandle>(null);
  const [fixture, select] = useState<keyof typeof fixtures>('flow');
  const [state, setState] = useState<string>();
  const [paused, pause] = useState(false);
  const [mounted, mount] = useState(true);
  const [enabled, enable] = useState(true);
  const [status, report] = useState('Loading bundled asset');
  const [loads, countLoads] = useState(0);
  return <ScrollView contentContainerStyle={styles.screen}>
    <Text accessibilityRole="header" style={styles.title}>Choco RN release verification</Text>
    <Text accessibilityLabel={`Playback status: ${status}`}>{status}</Text>
    <Text>Source: {fixture}; state: {state ?? 'idle'}; loads: {loads}</Text>
    <View style={styles.row}>
      {mounted && <Choco ref={player} source={fixtures[fixture]} state={state} paused={paused}
        playbackEnabled={enabled} style={styles.moment} accessibilityLabel="Controlled moment"
        onReady={() => { countLoads(value => value + 1); report('Loaded bundled .choco'); }}
        onError={error => report(`Error: ${error.message}`)} />}
      <Choco source={fixtures.pulse} paused style={styles.moment}
        accessibilityLabel="Independent paused moment" onError={error => report(`Error: ${error.message}`)} />
    </View>
    {(['flow', 'strokes', 'pulse'] as const).map(name => <Button key={name} title={`Source ${name}`} onPress={() => {
      select(name); setState(undefined); report('Loading bundled asset');
    }} />)}
    {['active', 'other', 'idle'].map(name => <Button key={name} title={`State ${name}`} onPress={() => setState(name)} />)}
    <Button title={paused ? 'Resume' : 'Pause'} onPress={() => pause(!paused)} />
    <Button title="Seek 0.5 seconds" onPress={() => player.current?.seek(0.5)} />
    <Button title="Click trigger" onPress={() => player.current?.trigger('click')} />
    <Button title="Change palette" onPress={() => player.current?.setPalette({accent: 0x2299aa, secondary: 0xee9933, ink: 0x203040, background: 0xffffff})} />
    <Button title="Look right" onPress={() => player.current?.look({x: 150, y: 50})} />
    <Button title="Release gaze" onPress={() => player.current?.look(null)} />
    <Button title={enabled ? 'Suspend playback' : 'Enable playback'} onPress={() => enable(!enabled)} />
    <Button title={mounted ? 'Unmount moment' : 'Mount moment'} onPress={() => mount(!mounted)} />
    <Button title="Invalid state" onPress={() => setState('missing-state')} />
    <Button title="Block JS for 2 seconds" onPress={() => {
      const end = Date.now() + 2000;
      while (Date.now() < end) { /* Deliberate contention; playback is owned by UIKit. */ }
      report('JS block finished');
    }} />
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: {paddingHorizontal: 20, paddingTop: 65, paddingBottom: 45, gap: 4},
  title: {fontSize: 22, fontWeight: '600'},
  row: {flexDirection: 'row'},
  moment: {width: '50%', height: 180},
});
