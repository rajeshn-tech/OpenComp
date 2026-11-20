/**
 * OpenComp - OpenFX (OFX) 1.4 Enums & Constants
 * Complete specification-compliant definitions from the Open Effects Association (OFX) 1.4 standard.
 * Reference: https://openfx.org
 */

// OFX Status Return Codes
export const OfxStatus = Object.freeze({
  kOfxStatOK: 0,
  kOfxStatFailed: 1,
  kOfxStatErrFatal: 2,
  kOfxStatErrUnknown: 3,
  kOfxStatErrMissingHostFeature: 4,
  kOfxStatErrUnsupported: 5,
  kOfxStatErrExists: 6,
  kOfxStatErrFormat: 7,
  kOfxStatErrMemory: 8,
  kOfxStatErrBadHandle: 9,
  kOfxStatErrBadIndex: 10,
  kOfxStatErrValue: 11,
  kOfxStatReplyYes: 12,
  kOfxStatReplyNo: 13,
  kOfxStatReplyDefault: 14
});

// OFX Suite Names & Versions
export const OfxSuites = Object.freeze({
  kOfxPropertySuite: 'OfxPropertySuite',
  kOfxParameterSuite: 'OfxParameterSuite',
  kOfxImageEffectSuite: 'OfxImageEffectSuite',
  kOfxMemorySuite: 'OfxMemorySuite',
  kOfxMultiThreadSuite: 'OfxMultiThreadSuite',
  kOfxMessageSuite: 'OfxMessageSuite'
});

// OFX Standard Actions
export const OfxActions = Object.freeze({
  kOfxActionLoad: 'OfxActionLoad',
  kOfxActionDescribe: 'OfxActionDescribe',
  kOfxActionCreateInstance: 'OfxActionCreateInstance',
  kOfxActionDestroyInstance: 'OfxActionDestroyInstance',
  kOfxActionInstanceChanged: 'OfxActionInstanceChanged',
  kOfxActionBeginInstanceChanged: 'OfxActionBeginInstanceChanged',
  kOfxActionEndInstanceChanged: 'OfxActionEndInstanceChanged',
  kOfxActionPurgeCaches: 'OfxActionPurgeCaches',
  kOfxActionSyncPrivateData: 'OfxActionSyncPrivateData',
  kOfxActionUnload: 'OfxActionUnload',

  // Image Effect Actions
  kOfxImageEffectActionDescribeInContext: 'OfxImageEffectActionDescribeInContext',
  kOfxImageEffectActionGetRegionOfDefinition: 'OfxImageEffectActionGetRegionOfDefinition',
  kOfxImageEffectActionGetRegionsOfInterest: 'OfxImageEffectActionGetRegionsOfInterest',
  kOfxImageEffectActionGetFramesNeeded: 'OfxImageEffectActionGetFramesNeeded',
  kOfxImageEffectActionBeginSequenceRender: 'OfxImageEffectActionBeginSequenceRender',
  kOfxImageEffectActionRender: 'OfxImageEffectActionRender',
  kOfxImageEffectActionEndSequenceRender: 'OfxImageEffectActionEndSequenceRender',
  kOfxImageEffectActionGetClipPreferences: 'OfxImageEffectActionGetClipPreferences'
});

// OFX Parameter Types
export const OfxParamTypes = Object.freeze({
  kOfxParamTypeInteger: 'OfxParamTypeInteger',
  kOfxParamTypeDouble: 'OfxParamTypeDouble',
  kOfxParamTypeBoolean: 'OfxParamTypeBoolean',
  kOfxParamTypeChoice: 'OfxParamTypeChoice',
  kOfxParamTypeRGBA: 'OfxParamTypeRGBA',
  kOfxParamTypeRGB: 'OfxParamTypeRGB',
  kOfxParamTypeDouble2D: 'OfxParamTypeDouble2D',
  kOfxParamTypeInteger2D: 'OfxParamTypeInteger2D',
  kOfxParamTypeDouble3D: 'OfxParamTypeDouble3D',
  kOfxParamTypeInteger3D: 'OfxParamTypeInteger3D',
  kOfxParamTypeString: 'OfxParamTypeString',
  kOfxParamTypeCustom: 'OfxParamTypeCustom',
  kOfxParamTypeGroup: 'OfxParamTypeGroup',
  kOfxParamTypePage: 'OfxParamTypePage',
  kOfxParamTypePushButton: 'OfxParamTypePushButton'
});

// OFX Image & Pixel Components
export const OfxImageComponents = Object.freeze({
  kOfxImageComponentNone: 'OfxImageComponentNone',
  kOfxImageComponentRGBA: 'OfxImageComponentRGBA',
  kOfxImageComponentRGB: 'OfxImageComponentRGB',
  kOfxImageComponentAlpha: 'OfxImageComponentAlpha'
});

// OFX Bit Depths
export const OfxBitDepths = Object.freeze({
  kOfxBitDepthNone: 'OfxBitDepthNone',
  kOfxBitDepthByte: 'OfxBitDepthByte',       // 8-bit unsigned integer [0, 255]
  kOfxBitDepthShort: 'OfxBitDepthShort',     // 16-bit unsigned integer [0, 65535]
  kOfxBitDepthFloat: 'OfxBitDepthFloat'      // 32-bit linear floating point
});

// OFX Contexts
export const OfxImageEffectContexts = Object.freeze({
  kOfxImageEffectContextGenerator: 'OfxImageEffectContextGenerator',
  kOfxImageEffectContextFilter: 'OfxImageEffectContextFilter',
  kOfxImageEffectContextTransition: 'OfxImageEffectContextTransition',
  kOfxImageEffectContextPaint: 'OfxImageEffectContextPaint',
  kOfxImageEffectContextGeneral: 'OfxImageEffectContextGeneral',
  kOfxImageEffectContextRetimer: 'OfxImageEffectContextRetimer'
});

// OFX Standard Property Keys
export const OfxProperties = Object.freeze({
  // Plugin Properties
  kOfxPropType: 'OfxPropType',
  kOfxPropName: 'OfxPropName',
  kOfxPropLabel: 'OfxPropLabel',
  kOfxPropShortLabel: 'OfxPropShortLabel',
  kOfxPropLongLabel: 'OfxPropLongLabel',
  kOfxPropVersion: 'OfxPropVersion',
  kOfxPropVersionLabel: 'OfxPropVersionLabel',
  kOfxPropPluginDescription: 'OfxPropPluginDescription',

  // Host Properties
  kOfxHostPropName: 'OfxHostPropName',
  kOfxHostPropVersion: 'OfxHostPropVersion',
  kOfxImageEffectHostPropIsBackground: 'OfxImageEffectHostPropIsBackground',
  kOfxImageEffectPropSupportsMultipleClipDepths: 'OfxImageEffectPropSupportsMultipleClipDepths',
  kOfxImageEffectPropSupportedContexts: 'OfxImageEffectPropSupportedContexts',
  kOfxImageEffectPropSupportedPixelDepths: 'OfxImageEffectPropSupportedPixelDepths',
  kOfxImageEffectPropSupportedComponents: 'OfxImageEffectPropSupportedComponents',

  // Clip Properties
  kOfxImageEffectPropTemporalClipAccess: 'OfxImageEffectPropTemporalClipAccess',
  kOfxImageClipPropOptional: 'OfxImageClipPropOptional',
  kOfxImageClipPropConnected: 'OfxImageClipPropConnected',
  kOfxImageClipPropIsOutput: 'OfxImageClipPropIsOutput',
  kOfxImageClipPropContinuousSamples: 'OfxImageClipPropContinuousSamples',
  kOfxImageEffectPropRenderWindow: 'OfxImageEffectPropRenderWindow',
  kOfxImageEffectPropRegionOfDefinition: 'OfxImageEffectPropRegionOfDefinition',
  kOfxImageEffectPropRegionOfInterest: 'OfxImageEffectPropRegionOfInterest',
  kOfxImagePropPreMultiplication: 'OfxImagePreMultiplication',
  kOfxImagePropPixelAspectRatio: 'OfxImagePropPixelAspectRatio',
  kOfxImagePropData: 'OfxImagePropData',
  kOfxImagePropBounds: 'OfxImagePropBounds',
  kOfxImagePropRowBytes: 'OfxImagePropRowBytes',

  // Param Properties
  kOfxParamPropType: 'OfxParamPropType',
  kOfxParamPropDefault: 'OfxParamPropDefault',
  kOfxParamPropMin: 'OfxParamPropMin',
  kOfxParamPropMax: 'OfxParamPropMax',
  kOfxParamPropDisplayMin: 'OfxParamPropDisplayMin',
  kOfxParamPropDisplayMax: 'OfxParamPropDisplayMax',
  kOfxParamPropAnimates: 'OfxParamPropAnimates',
  kOfxParamPropChoiceOption: 'OfxParamPropChoiceOption'
});

