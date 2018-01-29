import React, { Component } from "react";
import {
  Dimensions,
  Modal,
  DeviceEventEmitter,
  TouchableWithoutFeedback,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated
} from "react-native";
import PropTypes from "prop-types";
import {
  View,
  initializeRegistryWithDefinitions,
  registerAnimation,
  createAnimation
} from "react-native-animatable";
import * as ANIMATION_DEFINITIONS from "./animations";

import styles from "./index.style.js";

// Override default animations
initializeRegistryWithDefinitions(ANIMATION_DEFINITIONS);

// Utility for creating custom animations
const makeAnimation = (name, obj) => {
  registerAnimation(name, createAnimation(obj));
};

const isObject = obj => {
  return obj !== null && typeof obj === "object";
};

export class ReactNativeModal extends Component {
  static propTypes = {
    animationIn: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    animationInTiming: PropTypes.number,
    animationOut: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
    animationOutTiming: PropTypes.number,
    avoidKeyboard: PropTypes.bool,
    backdropColor: PropTypes.string,
    backdropOpacity: PropTypes.number,
    backdropTransitionInTiming: PropTypes.number,
    backdropTransitionOutTiming: PropTypes.number,
    children: PropTypes.node.isRequired,
    isVisible: PropTypes.bool.isRequired,
    onModalShow: PropTypes.func,
    onModalHide: PropTypes.func,
    onBackButtonPress: PropTypes.func,
    onBackdropPress: PropTypes.func,
    onSwipe: PropTypes.func,
    swipeThreshold: PropTypes.number,
    swipeDirection: PropTypes.oneOf(["up", "down", "left", "right"]),
    useNativeDriver: PropTypes.bool,
    style: PropTypes.any
  };

  static defaultProps = {
    animationIn: "slideInUp",
    animationInTiming: 300,
    animationOut: "slideOutDown",
    animationOutTiming: 300,
    avoidKeyboard: false,
    backdropColor: "black",
    backdropOpacity: 0.7,
    backdropTransitionInTiming: 300,
    backdropTransitionOutTiming: 300,
    onModalShow: () => null,
    onModalHide: () => null,
    isVisible: false,
    onBackdropPress: () => null,
    onBackButtonPress: () => null,
    swipeThreshold: 100,
    useNativeDriver: false
  };

  // We use an internal state for keeping track of the modal visibility: this allows us to keep
  // the modal visibile during the exit animation, even if the user has already change the
  // isVisible prop to false.
  // We store in the state the device width and height so that we can update the modal on
  // device rotation.
  state = {
    isVisible: false,
    deviceWidth: Dimensions.get("window").width,
    deviceHeight: Dimensions.get("window").height,
    isSwipeable: this.props.swipeDirection ? true : false,
    pan: null
  };

  transitionLock = null;
  inSwipeClosingState = false;
  swipeDirection = null;

  constructor(props) {
    super(props);
    this.buildAnimations(props);
    if (this.state.isSwipeable) {
      this.state = { ...this.state, pan: new Animated.ValueXY() };
      this.buildPanResponder();
    }
  }

  componentWillReceiveProps(nextProps) {
    if (!this.state.isVisible && nextProps.isVisible) {
      this.setState({ isVisible: true });
    }
    if (
      this.props.animationIn !== nextProps.animationIn ||
      this.props.animationOut !== nextProps.animationOut
    ) {
      this.buildAnimations(nextProps);
    }
    if (
      this.props.backdropOpacity !== nextProps.backdropOpacity &&
      this.backdropRef
    ) {
      this.backdropRef.transitionTo(
        { opacity: nextProps.backdropOpacity },
        this.props.backdropTransitionInTiming
      );
    }
  }

  componentWillMount() {
    if (this.props.isVisible) {
      this.setState({ isVisible: true });
    }
  }

  componentDidMount() {
    if (this.state.isVisible) {
      this.open();
    }
    DeviceEventEmitter.addListener(
      "didUpdateDimensions",
      this.handleDimensionsUpdate
    );
  }

  componentWillUnmount() {
    DeviceEventEmitter.removeListener(
      "didUpdateDimensions",
      this.handleDimensionsUpdate
    );
  }

  componentDidUpdate(prevProps, prevState) {
    // On modal open request, we slide the view up and fade in the backdrop
    if (this.props.isVisible && !prevProps.isVisible) {
      this.open();
    } else if (!this.props.isVisible && prevProps.isVisible) {
      // On modal close request, we slide the view down and fade out the backdrop
      this._close();
    }
  }

  buildPanResponder = () => {
    let animEvt = null;

    // if (
    //   this.props.swipeDirection === "right" ||
    //   this.props.swipeDirection === "left"
    // ) {
    //   animEvt = Animated.event([null, { dx: this.state.pan.x }]);
    // } else {
    //   animEvt = Animated.event([null, { dy: this.state.pan.y }]);
    // }
    animEvt = Animated.event([null, { dx: this.state.pan.x, dy: this.state.pan.y }]);

    this.panResponder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (evt, gestureState) => {
        // Dim the background while swiping the modal
        const acc = this.getAccDistancePerDirection(gestureState);
        const newOpacityFactor = 1 - acc.distance / this.state.deviceWidth;
        if (this.isSwipeDirectionAllowed(gestureState)) {
          this.backdropRef.transitionTo({
            opacity: this.props.backdropOpacity * newOpacityFactor
          });
          animEvt(evt, gestureState);
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        // Call the onSwipe prop if the threshold has been exceeded
        const acc = this.getAccDistancePerDirection(gestureState);
        if (acc.distance > this.props.swipeThreshold) {
          if (this.props.onSwipe) {
            this.inSwipeClosingState = true;
            this.swipeDirection = acc.direction;
            this.props.onSwipe();
            return;
          }
        }
        //Reset backdrop opacity and modal position
        this.backdropRef.transitionTo(
          { opacity: this.props.backdropOpacity },
          this.props.backdropTransitionInTiming
        );
        Animated.spring(this.state.pan, {
          toValue: { x: 0, y: 0 },
          bounciness: 0
        }).start();
      }
    });
  };

  getAccDistancePerDirection = gestureState => {
    let axis = Math.abs(gestureState.dx) > Math.abs(gestureState.dy) ? "horizontal" : "vertical";

    let swipeDirection = "up";
    if (axis == "vertical") {
      // Up
      if (gestureState.dy < 0) {
        swipeDirection = "up";

      // Down
      } else {
        swipeDirection = "down";
      }
    } else {

      // Left
      if (gestureState.dx < 0) {
        swipeDirection = "left";
      }

      // Right
      else {
        swipeDirection = "right";
      }
    }

    switch (swipeDirection) {
      case "up":
        return { direction: swipeDirection, distance: -gestureState.dy };
      case "down":
        return { direction: swipeDirection, distance: gestureState.dy };
      case "right":
        return { direction: swipeDirection, distance: gestureState.dx };
      case "left":
        return { direction: swipeDirection, distance: -gestureState.dx };
      default:
        return { direction: null, distance: 0 };
    }
  };

  isSwipeDirectionAllowed = ({ dy, dx }) => {
    // const draggedDown = dy > 0;
    // const draggedUp = dy < 0;
    // const draggedLeft = dx < 0;
    // const draggedRight = dx > 0;
    //
    // if (this.props.swipeDirection === "up" && draggedUp) {
    //   return true;
    // } else if (this.props.swipeDirection === "down" && draggedDown) {
    //   return true;
    // } else if (this.props.swipeDirection === "right" && draggedRight) {
    //   return true;
    // } else if (this.props.swipeDirection === "left" && draggedLeft) {
    //   return true;
    // }
    return true;
  };

  // User can define custom react-native-animatable animations, see PR #72
  buildAnimations = props => {
    let animationIn = props.animationIn;
    let animationOut = props.animationOut;

    if (isObject(animationIn)) {
      makeAnimation("animationIn", animationIn);
      animationIn = "animationIn";
    }

    if (isObject(animationOut)) {
      makeAnimation("animationOut", animationOut);
      animationOut = "animationOut";
    }

    this.animationIn = animationIn;
    this.animationOut = animationOut;

    // this.animationOut = {
    //   ""
    // }
  };

  handleDimensionsUpdate = dimensionsUpdate => {
    // Here we update the device dimensions in the state if the layout changed (triggering a render)
    const deviceWidth = Dimensions.get("window").width;
    const deviceHeight = Dimensions.get("window").height;
    if (
      deviceWidth !== this.state.deviceWidth ||
      deviceHeight !== this.state.deviceHeight
    ) {
      this.setState({ deviceWidth, deviceHeight });
    }
  };

  open = () => {
    if (this.transitionLock) return;
    this.transitionLock = true;
    this.backdropRef.transitionTo(
      { opacity: this.props.backdropOpacity },
      this.props.backdropTransitionInTiming
    );

    // This is for reset the pan position, if not modal get stuck
    // at the last release position when you try to open it.
    // Could certainly be improve - no idea for the moment.
    if (this.state.isSwipeable) {
      this.state.pan.setValue({ x: 0, y: 0 });
    }

    this.contentRef[this.animationIn](this.props.animationInTiming).then(() => {
      this.transitionLock = false;
      if (!this.props.isVisible) {
        this._close();
      } else {
        this.props.onModalShow();
      }
    });
  };

  _close = () => {
    if (this.transitionLock) return;
    this.transitionLock = true;
    this.backdropRef.transitionTo(
      { opacity: 0 },
      this.props.backdropTransitionOutTiming
    );

    let animationOut = this.animationOut;

    if (this.inSwipeClosingState) {
      this.inSwipeClosingState = false;
      if (this.swipeDirection === "up") {
        animationOut = "slideOutUp";
      } else if (this.swipeDirection === "down") {
        animationOut = "slideOutDown";
      } else if (this.swipeDirection === "right") {
        animationOut = "slideOutRight";
      } else if (this.swipeDirection === "left") {
        animationOut = "slideOutLeft";
      }
    }

    this.contentRef[animationOut](this.props.animationOutTiming).then(() => {
      this.transitionLock = false;
      if (this.props.isVisible) {
        this.open();
      } else {
        this.setState({ isVisible: false });
        this.props.onModalHide();
      }
    });
  };

  render() {
    const {
      animationIn,
      animationInTiming,
      animationOut,
      animationOutTiming,
      avoidKeyboard,
      backdropColor,
      backdropOpacity,
      backdropTransitionInTiming,
      backdropTransitionOutTiming,
      children,
      isVisible,
      onModalShow,
      onBackdropPress,
      onBackButtonPress,
      useNativeDriver,
      style,
      ...otherProps
    } = this.props;
    const { deviceWidth, deviceHeight } = this.state;

    const computedStyle = [
      { margin: deviceWidth * 0.05, transform: [{ translateY: 0 }] },
      styles.content,
      style
    ];

    let panHandlers = {};
    let panPosition = {};
    if (this.state.isSwipeable) {
      panHandlers = { ...this.panResponder.panHandlers };
      panPosition = this.state.pan.getLayout();
    }

    const containerView = (
      <View
        {...panHandlers}
        ref={ref => (this.contentRef = ref)}
        style={[panPosition, computedStyle]}
        pointerEvents="box-none"
        useNativeDriver={useNativeDriver}
        {...otherProps}
      >
        {children}
      </View>
    );

    return (
      <Modal
        transparent={true}
        animationType={"none"}
        visible={this.state.isVisible}
        onRequestClose={onBackButtonPress}
        {...otherProps}
      >
        <TouchableWithoutFeedback onPress={onBackdropPress}>
          <View
            ref={ref => (this.backdropRef = ref)}
            useNativeDriver={useNativeDriver}
            style={[
              styles.backdrop,
              {
                backgroundColor: backdropColor,
                width: deviceWidth,
                height: deviceHeight
              }
            ]}
          />
        </TouchableWithoutFeedback>

        {avoidKeyboard && (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : null}
            pointerEvents="box-none"
            style={computedStyle.concat([{ margin: 0 }])}
          >
            {containerView}
          </KeyboardAvoidingView>
        )}

        {!avoidKeyboard && containerView}
      </Modal>
    );
  }
}

export default ReactNativeModal;
