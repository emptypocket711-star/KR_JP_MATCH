import 'dart:io';

import 'profile_edit_data.dart';

abstract class ProfileRepository {
  Future<ProfileEditData> getMyProfileForEdit();

  Future<String> uploadMyProfilePhoto(File file);

  Future<void> deleteMyProfilePhoto(String reference);

  Future<void> saveMyProfile(ProfileEditData data);
}
