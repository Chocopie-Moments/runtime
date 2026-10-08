#import "CPChocoComponentView.h"
#import "ChocoReactNative-Swift.h"
#import <react/renderer/components/ChocoSpec/ComponentDescriptors.h>
#import <react/renderer/components/ChocoSpec/EventEmitters.h>
#import <react/renderer/components/ChocoSpec/Props.h>
#import <react/renderer/components/ChocoSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface CPChocoComponentView () <RCTChocoNativeViewViewProtocol>
@end

@implementation CPChocoComponentView {
  CPChocoHostView *_host;
}
+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<ChocoNativeViewComponentDescriptor>();
}
- (instancetype)initWithFrame:(CGRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _props = std::make_shared<const ChocoNativeViewProps>();
    _host = [[CPChocoHostView alloc] initWithFrame:self.bounds];
    self.contentView = _host;
    __weak CPChocoComponentView *weakSelf = self;
    _host.onLoad = ^{
      CPChocoComponentView *view = weakSelf;
      if (view && view->_eventEmitter) {
        auto emitter = std::static_pointer_cast<const ChocoNativeViewEventEmitter>(view->_eventEmitter);
        emitter->onLoad({true});
      }
    };
    _host.onError = ^(NSString *message) {
      CPChocoComponentView *view = weakSelf;
      if (view && view->_eventEmitter) {
        auto emitter = std::static_pointer_cast<const ChocoNativeViewEventEmitter>(view->_eventEmitter);
        emitter->onError({std::string(message.UTF8String)});
      }
    };
  }
  return self;
}
- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps {
  const auto &next = *std::static_pointer_cast<const ChocoNativeViewProps>(props);
  const auto &previous = *std::static_pointer_cast<const ChocoNativeViewProps>(_props);
  if (next.source != previous.source || next.state != previous.state || next.paused != previous.paused || next.playbackEnabled != previous.playbackEnabled) {
    [_host configureWithSource:[NSString stringWithUTF8String:next.source.c_str()]
                        state:[NSString stringWithUTF8String:next.state.c_str()] paused:next.paused playbackEnabled:next.playbackEnabled];
  }
  [super updateProps:props oldProps:oldProps];
}
- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args {
  RCTChocoNativeViewHandleCommand(self, commandName, args);
}
- (void)trigger:(NSString *)name { [_host trigger:name]; }
- (void)seek:(double)seconds { [_host seek:seconds]; }
- (void)look:(BOOL)active x:(double)x y:(double)y { [_host look:active x:x y:y]; }
- (void)palette:(double)accent secondary:(double)secondary ink:(double)ink background:(double)background {
  [_host palette:accent secondary:secondary ink:ink background:background];
}
- (void)prepareForRecycle {
  [_host reset];
  [super prepareForRecycle];
  _props = std::make_shared<const ChocoNativeViewProps>();
}
@end
