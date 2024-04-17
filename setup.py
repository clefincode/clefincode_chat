from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

# get version from __version__ variable in clefincode_chat/__init__.py
from clefincode_chat import __version__ as version

setup(
	name="clefincode_chat",
	version=version,
	description="ERPNext & Frappe Business Chat: A self-hosted communication solution.",
	author="ClefinCode L.L.C-FZ",
	author_email="info@clefincode.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
