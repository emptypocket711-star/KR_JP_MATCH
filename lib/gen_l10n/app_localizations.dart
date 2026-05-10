import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ja.dart';
import 'app_localizations_ko.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'gen_l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
      : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
    delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
  ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ja'),
    Locale('ko')
  ];

  /// No description provided for @appTitle.
  ///
  /// In ko, this message translates to:
  /// **'Hana'**
  String get appTitle;

  /// No description provided for @loginTitle.
  ///
  /// In ko, this message translates to:
  /// **'???'**
  String get loginTitle;

  /// No description provided for @loginWithPhone.
  ///
  /// In ko, this message translates to:
  /// **'????? ???'**
  String get loginWithPhone;

  /// No description provided for @loginWithGoogle.
  ///
  /// In ko, this message translates to:
  /// **'Google? ???'**
  String get loginWithGoogle;

  /// No description provided for @onboardingTitle.
  ///
  /// In ko, this message translates to:
  /// **'??? ??'**
  String get onboardingTitle;

  /// No description provided for @next.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get next;

  /// No description provided for @back.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get back;

  /// No description provided for @submit.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get submit;

  /// No description provided for @profileDisplayName.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get profileDisplayName;

  /// No description provided for @profileBio.
  ///
  /// In ko, this message translates to:
  /// **'????'**
  String get profileBio;

  /// No description provided for @profileGender.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get profileGender;

  /// No description provided for @profileNationality.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get profileNationality;

  /// No description provided for @profileBirthYear.
  ///
  /// In ko, this message translates to:
  /// **'????'**
  String get profileBirthYear;

  /// No description provided for @genderMale.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get genderMale;

  /// No description provided for @genderFemale.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get genderFemale;

  /// No description provided for @nationalityKR.
  ///
  /// In ko, this message translates to:
  /// **'????'**
  String get nationalityKR;

  /// No description provided for @nationalityJP.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get nationalityJP;

  /// No description provided for @discoveryNoMoreCandidates.
  ///
  /// In ko, this message translates to:
  /// **'? ?? ??? ???? ????.'**
  String get discoveryNoMoreCandidates;

  /// No description provided for @discoveryQuotaExhausted.
  ///
  /// In ko, this message translates to:
  /// **'?? ?? ??? ?? ??????. ?? ???? ????? ?? ??????.'**
  String get discoveryQuotaExhausted;

  /// No description provided for @like.
  ///
  /// In ko, this message translates to:
  /// **'???'**
  String get like;

  /// No description provided for @pass.
  ///
  /// In ko, this message translates to:
  /// **'????'**
  String get pass;

  /// No description provided for @match.
  ///
  /// In ko, this message translates to:
  /// **'???????'**
  String get match;

  /// No description provided for @chat.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get chat;

  /// No description provided for @matchesTitle.
  ///
  /// In ko, this message translates to:
  /// **'?? ??'**
  String get matchesTitle;

  /// No description provided for @noMatches.
  ///
  /// In ko, this message translates to:
  /// **'?? ??? ????.'**
  String get noMatches;

  /// No description provided for @sendMessage.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get sendMessage;

  /// No description provided for @messageInputHint.
  ///
  /// In ko, this message translates to:
  /// **'???? ?????'**
  String get messageInputHint;

  /// No description provided for @reportTitle.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get reportTitle;

  /// No description provided for @blockUser.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get blockUser;

  /// No description provided for @reportUser.
  ///
  /// In ko, this message translates to:
  /// **'????'**
  String get reportUser;

  /// No description provided for @settingsTitle.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get settingsTitle;

  /// No description provided for @logout.
  ///
  /// In ko, this message translates to:
  /// **'????'**
  String get logout;

  /// No description provided for @errorGeneric.
  ///
  /// In ko, this message translates to:
  /// **'??? ??????. ?? ??????.'**
  String get errorGeneric;

  /// No description provided for @loading.
  ///
  /// In ko, this message translates to:
  /// **'?? ?...'**
  String get loading;

  /// No description provided for @skip.
  ///
  /// In ko, this message translates to:
  /// **'????'**
  String get skip;

  /// No description provided for @profilePhotoHint.
  ///
  /// In ko, this message translates to:
  /// **'?? ?? (1~6?)'**
  String get profilePhotoHint;

  /// No description provided for @preferredGender.
  ///
  /// In ko, this message translates to:
  /// **'???? ??'**
  String get preferredGender;

  /// No description provided for @preferredNationality.
  ///
  /// In ko, this message translates to:
  /// **'???? ??'**
  String get preferredNationality;

  /// No description provided for @preferredAgeRange.
  ///
  /// In ko, this message translates to:
  /// **'???? ???'**
  String get preferredAgeRange;

  /// No description provided for @nativeLanguage.
  ///
  /// In ko, this message translates to:
  /// **'???'**
  String get nativeLanguage;

  /// No description provided for @learningLanguage.
  ///
  /// In ko, this message translates to:
  /// **'??? ?? ??'**
  String get learningLanguage;

  /// No description provided for @residingCountry.
  ///
  /// In ko, this message translates to:
  /// **'?? ??'**
  String get residingCountry;

  /// No description provided for @languageKorean.
  ///
  /// In ko, this message translates to:
  /// **'???'**
  String get languageKorean;

  /// No description provided for @languageJapanese.
  ///
  /// In ko, this message translates to:
  /// **'???'**
  String get languageJapanese;

  /// No description provided for @quotaRemaining.
  ///
  /// In ko, this message translates to:
  /// **'?? ??: {remaining}?'**
  String quotaRemaining(int remaining);

  /// No description provided for @purchaseMore.
  ///
  /// In ko, this message translates to:
  /// **'?? ??'**
  String get purchaseMore;

  /// No description provided for @resetAt.
  ///
  /// In ko, this message translates to:
  /// **'?? ??: {time}'**
  String resetAt(String time);

  /// No description provided for @noMessages.
  ///
  /// In ko, this message translates to:
  /// **'?? ???? ????.'**
  String get noMessages;

  /// No description provided for @typeMessage.
  ///
  /// In ko, this message translates to:
  /// **'???? ?????'**
  String get typeMessage;

  /// No description provided for @discovery.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get discovery;

  /// No description provided for @translating.
  ///
  /// In ko, this message translates to:
  /// **'?? ?...'**
  String get translating;

  /// No description provided for @retry.
  ///
  /// In ko, this message translates to:
  /// **'?? ??'**
  String get retry;

  /// No description provided for @noCandidatesAvailable.
  ///
  /// In ko, this message translates to:
  /// **'??? ??? ??? ????.'**
  String get noCandidatesAvailable;

  /// No description provided for @matches.
  ///
  /// In ko, this message translates to:
  /// **'??'**
  String get matches;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['ja', 'ko'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ja':
      return AppLocalizationsJa();
    case 'ko':
      return AppLocalizationsKo();
  }

  throw FlutterError(
      'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
      'an issue with the localizations generation tool. Please file an issue '
      'on GitHub with a reproducible sample app and the gen-l10n configuration '
      'that was used.');
}
