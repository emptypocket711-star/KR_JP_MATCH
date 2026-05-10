import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'dart:io' show Platform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (Platform.isAndroid) {
      return android;
    }
    if (Platform.isIOS) {
      return ios;
    }
    throw UnsupportedError(
      'DefaultFirebaseOptions are not supported for this platform.',
    );
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyBSjT_60NLy-pOxeKK1Qu75kEbojhwdyFk',
    appId: '1:701242900024:android:64219146df3291b21e30cd',
    messagingSenderId: '701242900024',
    projectId: 'hana-e2ee6',
    storageBucket: 'hana-e2ee6.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'IOS_API_KEY',
    appId: '1:IOS_APP_ID:ios:PROJECT_ID',
    messagingSenderId: 'MESSAGING_SENDER_ID',
    projectId: 'firebase-project-id',
    storageBucket: 'firebase-project-id.appspot.com',
    iosBundleId: 'com.krjp.match.app',
  );
}
