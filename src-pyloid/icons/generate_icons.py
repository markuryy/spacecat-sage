import os
from PIL import Image
import shutil
import subprocess

class IconConverter:
    def __init__(self, input_path):
        """Initialize converter with input PNG path."""
        self.input_path = input_path
        self.original_image = Image.open(input_path)
        
        # Ensure image is RGBA
        if self.original_image.mode != 'RGBA':
            self.original_image = self.original_image.convert('RGBA')

    def create_icon_files(self, output_folder):
        """Generate all required icon files."""
        # Paths for each icon
        icon_256_path = os.path.join(output_folder, "icon-256.png")
        icon_png_path = os.path.join(output_folder, "icon.png")
        icon_ico_path = os.path.join(output_folder, "icon.ico")
        icon_icns_path = os.path.join(output_folder, "icon.icns")

        # Generate icon-256.png
        self.original_image.resize((256, 256), Image.Resampling.LANCZOS).save(icon_256_path, "PNG")
        print(f"Created: {icon_256_path}")

        # Generate icon.png (655x655)
        self.original_image.resize((655, 655), Image.Resampling.LANCZOS).save(icon_png_path, "PNG")
        print(f"Created: {icon_png_path}")

        # Generate icon.ico
        ico_sizes = [(256, 256), (128, 128), (96, 96), (72, 72), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
        resized_images = [self.original_image.resize(size, Image.Resampling.LANCZOS) for size in ico_sizes]
        resized_images[0].save(icon_ico_path, format="ICO", sizes=ico_sizes)
        print(f"Created: {icon_ico_path}")

        # Generate icon.icns (macOS only)
        iconset_folder = os.path.join(output_folder, "temp.iconset")
        os.makedirs(iconset_folder, exist_ok=True)
        icns_sizes = [16, 32, 64, 128, 256, 512, 1024]

        for size in icns_sizes:
            temp_path = os.path.join(iconset_folder, f"icon_{size}x{size}.png")
            self.original_image.resize((size, size), Image.Resampling.LANCZOS).save(temp_path, "PNG")
        
        subprocess.run(["iconutil", "-c", "icns", iconset_folder, "-o", icon_icns_path])
        print(f"Created: {icon_icns_path}")
        shutil.rmtree(iconset_folder)

if __name__ == "__main__":
    input_file = "Icon@3x.png"
    output_folder = os.getcwd()

    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found in the current folder.")
        exit(1)

    converter = IconConverter(input_file)
    converter.create_icon_files(output_folder)