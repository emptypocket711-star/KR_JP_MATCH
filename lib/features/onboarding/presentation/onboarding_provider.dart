import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/onboarding_repository_impl.dart';
import '../domain/onboarding_repository.dart';

final onboardingRepositoryProvider = Provider<OnboardingRepository>((ref) {
  return OnboardingRepositoryImpl();
});

final onboardingFormStateProvider =
    NotifierProvider<OnboardingFormNotifier, OnboardingFormState>(() {
  return OnboardingFormNotifier();
});

class OnboardingFormState {
  final String relationshipType;
  final String displayName;
  final int? birthYear;
  final String? gender;
  final String? nationality;
  final String? residingCountry;
  final String? nativeLanguage;
  final String? learningLanguage;
  final String bio;
  final String occupation;
  final List<String> keywords;
  final List<Map<String, String>> qaItems;
  final List<String> photoUrls;
  final String? preferredGender;
  final String? preferredNationality;
  final int? preferredAgeMin;
  final int? preferredAgeMax;

  OnboardingFormState({
    this.relationshipType = '',
    this.displayName = '',
    this.birthYear,
    this.gender,
    this.nationality,
    this.residingCountry,
    this.nativeLanguage,
    this.learningLanguage,
    this.bio = '',
    this.occupation = '',
    this.keywords = const [],
    this.qaItems = const [],
    this.photoUrls = const [],
    this.preferredGender,
    this.preferredNationality,
    this.preferredAgeMin,
    this.preferredAgeMax,
  });

  OnboardingFormState copyWith({
    String? relationshipType,
    String? displayName,
    int? birthYear,
    String? gender,
    String? nationality,
    String? residingCountry,
    String? nativeLanguage,
    String? learningLanguage,
    String? bio,
    String? occupation,
    List<String>? keywords,
    List<Map<String, String>>? qaItems,
    List<String>? photoUrls,
    String? preferredGender,
    String? preferredNationality,
    int? preferredAgeMin,
    int? preferredAgeMax,
  }) {
    return OnboardingFormState(
      relationshipType: relationshipType ?? this.relationshipType,
      displayName: displayName ?? this.displayName,
      birthYear: birthYear ?? this.birthYear,
      gender: gender ?? this.gender,
      nationality: nationality ?? this.nationality,
      residingCountry: residingCountry ?? this.residingCountry,
      nativeLanguage: nativeLanguage ?? this.nativeLanguage,
      learningLanguage: learningLanguage ?? this.learningLanguage,
      bio: bio ?? this.bio,
      occupation: occupation ?? this.occupation,
      keywords: keywords ?? this.keywords,
      qaItems: qaItems ?? this.qaItems,
      photoUrls: photoUrls ?? this.photoUrls,
      preferredGender: preferredGender ?? this.preferredGender,
      preferredNationality: preferredNationality ?? this.preferredNationality,
      preferredAgeMin: preferredAgeMin ?? this.preferredAgeMin,
      preferredAgeMax: preferredAgeMax ?? this.preferredAgeMax,
    );
  }
}

class OnboardingFormNotifier extends Notifier<OnboardingFormState> {
  @override
  OnboardingFormState build() => OnboardingFormState();

  void setRelationshipType(String value) =>
      state = state.copyWith(relationshipType: value);
  void setDisplayName(String value) =>
      state = state.copyWith(displayName: value);
  void setBirthYear(int value) => state = state.copyWith(birthYear: value);
  void setGender(String value) => state = state.copyWith(gender: value);
  void setNationality(String value) =>
      state = state.copyWith(nationality: value);
  void setResidingCountry(String value) =>
      state = state.copyWith(residingCountry: value);
  void setNativeLanguage(String value) =>
      state = state.copyWith(nativeLanguage: value);
  void setLearningLanguage(String value) =>
      state = state.copyWith(learningLanguage: value);
  void setBio(String value) => state = state.copyWith(bio: value);
  void setOccupation(String value) => state = state.copyWith(occupation: value);

  void toggleKeyword(String keyword) {
    final current = List<String>.from(state.keywords);
    if (current.contains(keyword)) {
      current.remove(keyword);
    } else if (current.length < 5) {
      current.add(keyword);
    }
    state = state.copyWith(keywords: current);
  }

  void setQaItem(int index, String question, String answer) {
    final current = List<Map<String, String>>.from(state.qaItems);
    while (current.length <= index) {
      current.add({'question': '', 'answer': ''});
    }
    current[index] = {'question': question, 'answer': answer};
    state = state.copyWith(qaItems: current);
  }

  void addPhotoUrl(String url) =>
      state = state.copyWith(photoUrls: [...state.photoUrls, url]);
  void removePhotoUrl(String url) => state = state.copyWith(
      photoUrls: state.photoUrls.where((u) => u != url).toList());
  void setPreferredGender(String value) =>
      state = state.copyWith(preferredGender: value);
  void setPreferredNationality(String value) =>
      state = state.copyWith(preferredNationality: value);
  void setPreferredAgeMin(int value) =>
      state = state.copyWith(preferredAgeMin: value);
  void setPreferredAgeMax(int value) =>
      state = state.copyWith(preferredAgeMax: value);
  void reset() => state = OnboardingFormState();
}
